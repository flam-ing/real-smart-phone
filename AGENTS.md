# Notes for coding agents

## Server access

The server is an OCI instance in Chuncheon (`chuncheon-arm-a1`, 134.185.119.246, app in `/opt/real-smart-phone`, systemd unit `real-smart-phone`).

- Use the OCI API (profile `CHUNCHEON` in `~/.oci/config`) and its Run Command to inspect or deploy. Do not start with SSH.
- Do not route through `hye-macmini` or any other jump host.
- On the company network, SSH to the server is cut by the network even though TCP 22 connects, and HTTPS goes through a company certificate: pass a CA bundle that includes it (for the Python SDK, set `client.base_client.session.verify`).
- Run Command executes as `ocarun`. Until `ocarun` has passwordless sudo, it can read but cannot replace root-owned files or restart the service.
- Server settings live in `/etc/real-smart-phone.env` (root, 0600). Back up before changing.
