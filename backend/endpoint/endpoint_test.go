package endpoint

import (
	"encoding/json"
	"os"
	"testing"
)

// The facts and their words for made-up reads, as ucode makes them (testdata/trace.uc, scripts/ucode-golden.sh).
func TestAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Rows []struct {
			Host  string `json:"host"`
			Reads struct {
				IPs     []string  `json:"ips"`
				WAN     *string   `json:"wan"`
				Router6 *[]string `json:"router6"`
			} `json:"reads"`
			Facts json.RawMessage `json:"facts"`
			Words struct {
				Status string `json:"status"`
				Text   string `json:"text"`
			} `json:"words"`
		} `json:"rows"`
		Hosts map[string]bool `json:"hosts"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Rows) < 25 || len(trace.Hosts) < 12 {
		t.Fatalf("too little: %d rows, %d hosts", len(trace.Rows), len(trace.Hosts))
	}
	statuses := map[string]int{}
	for i, row := range trace.Rows {
		r := Reads{IPs: row.Reads.IPs}
		if row.Reads.WAN != nil {
			r.WAN = *row.Reads.WAN
		}
		if row.Reads.Router6 != nil {
			r.Router6, r.Known6 = *row.Reads.Router6, true
		}
		f := Of(row.Host, r)
		got, _ := json.Marshal(f)
		var a, b any
		json.Unmarshal(got, &a)
		json.Unmarshal(row.Facts, &b)
		ga, _ := json.Marshal(a)
		gb, _ := json.Marshal(b)
		if string(ga) != string(gb) {
			t.Errorf("row %d facts\n go:    %s\n ucode: %s", i, ga, gb)
		}
		status, text := Words(f, "UDP 4500", nil)
		statuses[status]++
		if status != row.Words.Status || text != row.Words.Text {
			t.Errorf("row %d words\n go:    %s %s\n ucode: %s %s", i, status, text, row.Words.Status, row.Words.Text)
		}
	}
	if statuses["ok"] < 3 || statuses["warn"] < 8 || statuses["error"] < 3 {
		t.Fatalf("the rows exercise too little: %v", statuses)
	}
	for h, want := range trace.Hosts {
		if got := ValidHost(h); got != want {
			t.Errorf("ValidHost(%q) = %v, ucode %v", h, got, want)
		}
	}
}
