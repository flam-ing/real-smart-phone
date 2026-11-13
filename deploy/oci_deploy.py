"""Deploy or inspect the Chuncheon server through the OCI API (Run Command), no SSH.

  uv run --with oci python deploy/oci_deploy.py run 'systemctl is-active real-smart-phone'
  uv run --with oci python deploy/oci_deploy.py deploy <commit> agent.js providers/gemini.js ...

deploy downloads each file from GitHub at that commit (the repo is public), backs up the
current copy under /root/rsp-backup/<time>/, installs it, checks agent.js and server.js with
node --check, and restarts the service.

Uses profile CHUNCHEON in ~/.oci/config. On a network that swaps in its own HTTPS certificate,
set OCI_CA_BUNDLE to a PEM file that includes it.
"""
import os, sys, time, shlex
import oci

INSTANCE = "ocid1.instance.oc1.ap-chuncheon-1.an4w4ljrwkpsmvqcmum7lpwypvwyqoblrctwiuhzpeqcv4wxximh53fk3cra"
REPO = "https://raw.githubusercontent.com/flam-ing/real-smart-phone"
APP = "/opt/real-smart-phone"


def run(script, timeout=600):
    cfg = oci.config.from_file(profile_name="CHUNCHEON")
    client = oci.compute_instance_agent.ComputeInstanceAgentClient(cfg)
    if os.environ.get("OCI_CA_BUNDLE"):
        client.base_client.session.verify = os.environ["OCI_CA_BUNDLE"]
    M = oci.compute_instance_agent.models
    cmd = client.create_instance_agent_command(M.CreateInstanceAgentCommandDetails(
        compartment_id=cfg["tenancy"], execution_time_out_in_seconds=timeout, display_name="real-smart-phone",
        target=M.InstanceAgentCommandTarget(instance_id=INSTANCE),
        content=M.InstanceAgentCommandContent(
            source=M.InstanceAgentCommandSourceViaTextDetails(source_type="TEXT", text=script),
            output=M.InstanceAgentCommandOutputViaTextDetails(output_type="TEXT")))).data
    deadline = time.time() + timeout + 60
    while time.time() < deadline:
        time.sleep(5)
        e = client.get_instance_agent_command_execution(cmd.id, INSTANCE).data
        if e.lifecycle_state in ("SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELED"):
            print(e.content.text or "", end="")
            print(f"[{e.lifecycle_state}, exit {e.content.exit_code}]")
            return e.content.exit_code or 0
    print("[no result yet]")
    return 1


def deploy(commit, files):
    q = shlex.quote
    lines = ["set -e", f"B=/root/rsp-backup/$(date +%Y%m%d-%H%M%S)", "T=$(mktemp -d)"]
    for f in files:
        lines.append(f"curl -fsSL {q(f'{REPO}/{commit}/{f}')} -o \"$T/{f.replace('/', '__')}\"")
    for f in files:
        lines += [f"sudo mkdir -p \"$B/$(dirname {q(f)})\"",
                  f"[ -f {APP}/{q(f)} ] && sudo cp {APP}/{q(f)} \"$B/{f}\" || true",
                  f"sudo install -D -m 644 -o root -g root \"$T/{f.replace('/', '__')}\" {APP}/{q(f)}"]
    lines += ["rm -rf \"$T\"", f"cd {APP} && sudo node --check agent.js && sudo node --check server.js",
              "sudo systemctl restart real-smart-phone", "sleep 3", "systemctl is-active real-smart-phone",
              "echo backup: $B"]
    return run("\n".join(lines))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "run":
        sys.exit(run(sys.argv[2]))
    if len(sys.argv) >= 4 and sys.argv[1] == "deploy":
        sys.exit(deploy(sys.argv[2], sys.argv[3:]))
    print(__doc__)
    sys.exit(2)
