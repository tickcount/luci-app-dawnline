// Features that are built but kept off: each flag says why it is off and what
// turns it back on. Read at build time; the admin and the portal share them.

/**
 * V2RayTun on Windows (the admin's set-up of a computer, the portal's picker
 * on a Windows computer). Off since November 2026: its AmneziaWG core
 * (awgcore.dll from v2RayTun 3.10.15) never gives the tunnel the server's DNS
 * (main.configureInterface has no SetDNS), so Windows keeps its own DNS, and
 * with a full tunnel its firewall lets DNS reach the server's DNS alone: no
 * names at all. Reported to V2RayTun; turn it on once a release fixes it
 * (check that the tunnel adapter gets the DNS line of the .conf).
 */
export const V2R_WINDOWS = false;
