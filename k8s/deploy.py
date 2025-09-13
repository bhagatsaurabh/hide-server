import yaml, subprocess, sys, os

if len(sys.argv) < 3:
    print("Usage: deploy.py <changed_services_csv> <sha>")
    sys.exit(1)

changed = sys.argv[1].split(",") if sys.argv[1] else []
sha = sys.argv[2]

with open("../dependencies.yml") as f:
    deps = yaml.safe_load(f)

to_deploy = set(changed)


def add_dependents(service):
    for dep, cfg in deps.items():
        if service in cfg.get("depends_on", []):
            if dep not in to_deploy:
                to_deploy.add(dep)
                add_dependents(dep)


for s in changed:
    add_dependents(s)

print("Changed services:", changed)
print("Final services to deploy/restart:", to_deploy)

for s in to_deploy:
    if s in changed:
        print(f"Updating and deploying {s}")
        subprocess.run(
            f"kustomize edit set image {s}=ghcr.io/{os.getenv('GITHUB_REPOSITORY')}/{s}:{sha}",
            shell=True,
            check=True,
        )
        subprocess.run("kubectl apply -k .", shell=True, check=True)
    else:
        print(f"Restarting dependent {s}")
        subprocess.run(
            f"kubectl rollout restart deployment {s}", shell=True, check=True
        )
