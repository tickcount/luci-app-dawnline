//go:build ubusd

// Against a real ubusd, with OpenWrt's own ubus tool on the other side
// (scripts/backend-container.sh runs it in the rootfs containers).
package ubus

import (
	"bufio"
	"context"
	"encoding/json"
	"os/exec"
	"reflect"
	"testing"
	"time"
)

func TestRealBus(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	watched := make(chan bool, 4)
	obj := &Object{
		Name: "dawnline.selftest",
		Methods: []Method{
			{Name: "echo", Params: map[string]Kind{"value": Table}, Handle: func(_ context.Context, args map[string]any) (map[string]any, error) {
				return args, nil
			}},
			{Name: "nothing", Handle: func(context.Context, map[string]any) (map[string]any, error) { return nil, nil }},
			{Name: "refuse", Handle: func(context.Context, map[string]any) (map[string]any, error) {
				return nil, StatusPermissionDenied
			}},
		},
		Watched: func(on bool) { watched <- on },
	}
	bus := NewBus(Socket, obj)
	bus.Log = t.Logf
	go bus.Run(ctx)
	// On the bus once the tool sees it.
	for exec.CommandContext(ctx, "ubus", "list", obj.Name).Run() != nil {
		if ctx.Err() != nil {
			t.Fatal("the object never appeared on the bus")
		}
		time.Sleep(50 * time.Millisecond)
	}

	// The signature, as `ubus -v list` prints it.
	out, err := exec.CommandContext(ctx, "ubus", "-v", "list", obj.Name).CombinedOutput()
	if err != nil {
		t.Fatalf("ubus -v list: %v\n%s", err, out)
	}
	t.Logf("%s", out)

	// A call from the tool: what comes back is what went in.
	in := `{"s":"x","n":1,"big":5000000000,"f":2.5,"b":true,"z":null,"l":[1,"two",{"k":false}],"t":{"u":{}}}`
	out, err = exec.CommandContext(ctx, "ubus", "call", obj.Name, "echo", in).Output()
	if err != nil {
		t.Fatalf("ubus call: %v", err)
	}
	var want, got any
	json.Unmarshal([]byte(in), &want)
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("answer is not JSON: %s", out)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("echo: got %s", out)
	}
	if out, err := exec.CommandContext(ctx, "ubus", "call", obj.Name, "nothing").CombinedOutput(); err != nil {
		t.Fatalf("a call answered with nothing failed: %v %s", err, out)
	}
	// A handler's status is the tool's exit code, negated (an 8-bit one: 256 - 6).
	err = exec.CommandContext(ctx, "ubus", "call", obj.Name, "refuse").Run()
	if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 256-int(StatusPermissionDenied) {
		t.Fatalf("refuse: %v", err)
	}
	if err := exec.CommandContext(ctx, "ubus", "call", obj.Name, "absent").Run(); err == nil {
		t.Fatal("a method that is not there answered")
	}

	// A call from our side, on a second connection.
	c, err := Dial(Socket)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	res, err := c.Call(ctx, obj.Name, "echo", map[string]any{"hello": "bus", "n": 7})
	if err != nil || res["hello"] != "bus" || res["n"] != int64(7) {
		t.Fatalf("Call: %v %v", res, err)
	}
	if _, err := c.Call(ctx, "no.such.object", "x", nil); err == nil {
		t.Fatal("a call on an object that is not there answered")
	}

	// A subscriber: we are told it came, it gets the notification, we are told it left.
	sub := exec.CommandContext(ctx, "ubus", "subscribe", obj.Name)
	pipe, _ := sub.StdoutPipe()
	if err := sub.Start(); err != nil {
		t.Fatal(err)
	}
	select {
	case on := <-watched:
		if !on {
			t.Fatal("told the subscriber left before it came")
		}
	case <-ctx.Done():
		t.Fatal("never told of the subscriber")
	}
	if err := bus.Notify(obj, "patch", map[string]any{"rev": 12, "ops": map[string]any{"online": true}}); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(pipe).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	var note map[string]any
	if err := json.Unmarshal([]byte(line), &note); err != nil {
		t.Fatalf("notification is not JSON: %s", line)
	}
	wantNote := map[string]any{"patch": map[string]any{"rev": float64(12), "ops": map[string]any{"online": true}}}
	if !reflect.DeepEqual(note, wantNote) {
		t.Fatalf("notification: %s", line)
	}
	sub.Process.Kill()
	sub.Wait()
	select {
	case on := <-watched:
		if on {
			t.Fatal("told a subscriber came when it left")
		}
	case <-ctx.Done():
		t.Fatal("never told the subscriber left")
	}
}
