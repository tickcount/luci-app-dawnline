// What follows from the settings about a server's addresses and a device's link, as dawnline.core works
// them out (server_address, tunnel_mtu, device_mtu, endpoint_host, dns_list, client_dns). Pure.

package model

import "github.com/tickcount/luci-app-dawnline/backend/ipnet"

const (
	// autoMTU is a tunnel's MTU when none is set, before its disguise's padding; mobileMTU what a phone
	// or a tablet gets at the most, and the least a tunnel has.
	autoMTU   = 1380
	mobileMTU = 1280
	// A device's own MTU is taken within this range.
	mtuMin, mtuMax = 1280, 1500
)

// ToInt is a value as a whole number as ucode reads one (what is after the point is dropped), or dflt
// when it is empty or no number.
func ToInt(v string, dflt int) int {
	if v == "" {
		return dflt
	}
	n, ok := number(v)
	if !ok {
		return dflt
	}
	return int(n)
}

// Number is a value as ucode's unary plus reads it; ok is false for what is no number.
func Number(v string) (float64, bool) { return number(v) }

// ServerAddress is the router's address inside a server's subnet (its first host), or "".
func ServerAddress(srv *Server) string {
	n, ok := ipnet.Subnet(srv.Subnet)
	if !ok {
		return ""
	}
	return ipnet.String(n.First())
}

// TunnelMTU is the server's tunnel MTU: the one set, or the automatic one for its disguise.
func TunnelMTU(srv *Server) int {
	if srv.MTU != 0 {
		return srv.MTU
	}
	return max(mobileMTU, autoMTU-ToInt(srv.Obf["s4"], 0))
}

// DeviceMTU is the MTU a device's configuration carries: its own when the admin set one, else the
// tunnel's, at most 1280 for phones and tablets.
func DeviceMTU(srv *Server, dev *Device) int {
	if dev.MTU >= mtuMin && dev.MTU <= mtuMax {
		return dev.MTU
	}
	mtu := TunnelMTU(srv)
	if dev.Kind == "phone" || dev.Kind == "tablet" {
		return min(mtu, mobileMTU)
	}
	return mtu
}

// EndpointHost is the address devices connect to: the server's own, else the portal's.
func (m *Model) EndpointHost(srv *Server) string {
	if srv.Endpoint != "" {
		return srv.Endpoint
	}
	return m.Settings.PortalHost
}

// DNSList is the DNS a server's clients are given: the servers set for it, else the router's address in
// its subnet (which never changes after setup; the router forwards each query where it belongs).
func DNSList(srv *Server) []string {
	if srv == nil {
		return []string{}
	}
	if len(srv.DNS) > 0 {
		return srv.DNS
	}
	if a := ServerAddress(srv); a != "" {
		return []string{a}
	}
	return []string{}
}

// ClientDNS is the DNS a person's devices use. Home-only people keep their device's DNS unless they chose
// home names; then the first server is Dawnline's resolver (reached through the tunnel) and the second
// the fallback the device uses when the tunnel is down.
func (m *Model) ClientDNS(srv *Server, p *Person) []string {
	if p == nil || p.Access != "lan" {
		return DNSList(srv)
	}
	if p.DNSMode != "home" {
		return []string{}
	}
	out := []string{}
	a := ServerAddress(srv)
	if a != "" {
		out = append(out, a)
	}
	if f := m.Settings.HomeDNSFallback; f != "" && f != a {
		out = append(out, f)
	}
	return out
}
