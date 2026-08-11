# Demo App HPA Design

## Goal

Provide a persistent, observable HPA target behind the existing Kong NodePort so the staged Locust run can measure Kubernetes scaling reaction time without using a synthetic HPA object that Argo CD will remove.

## Current constraints

- Kubernetes is v1.28.15 and does not currently expose `metrics.k8s.io`.
- Argo CD automatically syncs and self-heals the `demo-app/nginx-php` Deployment from the `main` branch of the GitOps repository.
- The Deployment has two containers and neither declares CPU requests, so a CPU-utilization HPA cannot calculate a target.
- Kong exposes the application through NodePort 30080 and the `rakko.site` host route.
- All nodes must be Ready and free of DiskPressure before a load run begins.

## Selected design

Install the upstream Metrics Server v0.7.2 release in `kube-system`, the release line compatible with Kubernetes v1.28. Add CPU and memory requests and limits to both `nginx` and `php-fpm` in the GitOps source. Add an `autoscaling/v2` HPA for the Deployment with:

- minimum replicas: 2
- maximum replicas: 20
- average CPU utilization target: 60%
- scale-up stabilization: 0 seconds
- scale-up maximum: 100 percent or four Pods per 15 seconds
- scale-down stabilization: 300 seconds

The resource budget is:

- `nginx`: request 100m CPU / 64Mi memory; limit 500m CPU / 256Mi memory
- `php-fpm`: request 100m CPU / 128Mi memory; limit 1000m CPU / 512Mi memory

This caps scheduled CPU requests at 4 cores when the HPA reaches 20 replicas while leaving enough burst capacity for the lab.

## Deployment flow

1. Confirm monitoring and node DiskPressure have stabilized.
2. Apply the pinned upstream Metrics Server manifest and wait for its APIService.
3. If and only if kubelet certificate verification prevents collection in this lab, add the documented `--kubelet-insecure-tls` lab flag and record that exception.
4. Commit and push the Deployment resources and HPA manifest to the GitOps `main` branch.
5. Wait for Argo CD sync, Deployment rollout, and HPA metric availability.
6. Verify `kubectl top nodes`, `kubectl top pods -n demo-app`, and `kubectl get hpa -n demo-app`.

## Failure handling

- Do not start a load test while any node has DiskPressure.
- Do not declare the Metrics API healthy until the APIService is Available and fresh node/Pod samples are returned.
- Do not patch the live Deployment as the primary configuration because Argo CD self-heal would revert it.
- Roll back only the new Git commit if the Deployment rollout or HPA metric path fails; do not delete application PVCs or unrelated workloads.

## Success criteria

- `v1beta1.metrics.k8s.io` is Available.
- `kubectl top nodes` and `kubectl top pods -n demo-app` return samples.
- `nginx-php` remains available with two baseline replicas.
- HPA shows a numeric CPU target rather than `<unknown>`.
- The next staged Locust run can correlate stage start, HPA desired replica change, Deployment replica change, scheduling, and readiness timestamps.
