package awg

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

const (
	serverKey = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg="
	peerOn    = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw="
	peerNew   = "TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0="
)

// The project's fixtures are `awg show all dump` (the ifname first); one interface's dump has no ifname.
func fixture(t *testing.T, name string) string {
	raw, err := os.ReadFile("testdata/awg-dump-" + name + ".txt")
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, l := range strings.Split(string(raw), "\n") {
		if l != "" {
			out = append(out, strings.TrimPrefix(l, "awgmain\t"))
		}
	}
	return strings.Join(out, "\n") + "\n"
}

// A stand-in for the router: the dump it prints and the index /sys gives, by the read.
func stand(out string, ok bool, indexes ...int) Reader {
	i := 0
	return Reader{
		Show: func(string) (string, bool) { return out, ok },
		Index: func(string) (int, bool) {
			ix := indexes[min(i, len(indexes)-1)]
			i++
			return ix, ix != 0
		},
	}
}

// What dawnline.awg dump() reads of the same fixtures (tests/ucode/awg.test.uc).
func TestDumpGenerations(t *testing.T) {
	d := stand(fixture(t, "1.0"), true, 7).Dump([]string{"dawn0"})
	want := Dump{OK: true, Reads: map[string]string{"dawn0": Read},
		Ifaces: map[string]Iface{"dawn0": {PublicKey: serverKey, Port: 51820, Ifindex: 7}},
		Peers: map[string]Peer{
			peerOn:  {Ifname: "dawn0", Endpoint: "203.0.113.7:41821", Handshake: 1760000000, Rx: 123456, Tx: 654321},
			peerNew: {Ifname: "dawn0"},
		}}
	if !reflect.DeepEqual(d, want) {
		t.Fatalf("1.0: %+v", d)
	}
	d = stand(fixture(t, "2.0"), true, 7).Dump([]string{"dawn0"})
	if d.Ifaces["dawn0"].Port != 51820 || len(d.Peers) != 1 || d.Peers[peerOn].Handshake == 0 {
		t.Fatalf("2.0: %+v", d)
	}
	d = stand(fixture(t, "3.1"), true, 7).Dump([]string{"dawn0"})
	if d.Ifaces["dawn0"].PublicKey != serverKey || len(d.Peers) != 2 {
		t.Fatalf("3.1: %+v", d)
	}
}

func TestDumpStates(t *testing.T) {
	asked := false
	r := Reader{Show: func(string) (string, bool) { asked = true; return "", true }, Index: func(string) (int, bool) { return 0, false }}
	if d := r.Dump([]string{"dawn0"}); !d.OK || d.Reads["dawn0"] != Down || asked {
		t.Fatalf("a tunnel that is not there: %+v, asked %v", d, asked)
	}
	one := fixture(t, "1.0")
	if d := stand(one, true, 7, 0).Dump([]string{"dawn0"}); d.Reads["dawn0"] != Down || len(d.Peers) != 0 {
		t.Fatalf("gone during the read: %+v", d)
	}
	if d := stand(one, true, 7, 9).Dump([]string{"dawn0"}); d.OK || d.Reads["dawn0"] != Failed || len(d.Peers) != 0 {
		t.Fatalf("set up again during the read: %+v", d)
	}
	if d := stand("", false, 7).Dump([]string{"dawn0"}); d.OK || d.Reads["dawn0"] != Failed {
		t.Fatalf("the tool failed: %+v", d)
	}
	if d := stand("not a dump\n", true, 7).Dump([]string{"dawn0"}); d.Reads["dawn0"] != Failed {
		t.Fatalf("no interface line: %+v", d)
	}
	if d := (Reader{}).Dump(nil); !d.OK || len(d.Reads) != 0 {
		t.Fatalf("no tunnels: %+v", d)
	}
}

func TestValidKey(t *testing.T) {
	for _, k := range []string{serverKey, peerOn, peerNew} {
		if !ValidKey(k) {
			t.Errorf("%s refused", k)
		}
	}
	for _, k := range []string{"", "(none)", serverKey[:43], serverKey[:42] + "B=", "!" + serverKey[1:], serverKey + "="} {
		if ValidKey(k) {
			t.Errorf("%q accepted", k)
		}
	}
}
