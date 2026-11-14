# Notes for coding agents

## Server access

The server is an OCI instance in Chuncheon (`chuncheon-arm-a1`, 134.185.119.246, app in `/opt/real-smart-phone`, systemd unit `real-smart-phone`).

- Use the OCI API (profile `CHUNCHEON` in `~/.oci/config`) and its Run Command to inspect or deploy. Do not start with SSH.
- Do not route through `hye-macmini` or any other jump host.
- On the company network, SSH to the server is cut by the network even though TCP 22 connects, and HTTPS goes through a company certificate: set `OCI_CA_BUNDLE` to a PEM bundle that includes it (this Mac keeps one at `~/.oci/company-ca.pem`, made by exporting the keychains with `security find-certificate -a -p`).
- Run Command executes as `ocarun`, which has passwordless sudo (`/etc/sudoers.d/101-oracle-cloud-agent-run-command`).
- Deploy: push to `main`, then `uv run --with oci python deploy/oci_deploy.py deploy <commit> <files...>`. It pulls the files from GitHub at that commit, backs up the old ones under `/root/rsp-backup/`, checks syntax and restarts the service. Any one-off command: `deploy/oci_deploy.py run '<shell>'`.
- A restart ends any AI run in progress; check the journal for recent `ai_run` lines first.
- Server settings live in `/etc/real-smart-phone.env` (root, 0600). Back up before changing.
