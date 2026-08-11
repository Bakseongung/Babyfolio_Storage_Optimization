# Demo App HPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a working resource Metrics API and persist a CPU HPA for the Kong-routed `demo-app/nginx-php` Deployment.

**Architecture:** Metrics Server v0.7.2 runs in `kube-system` and supplies node and Pod CPU samples through `metrics.k8s.io`. The application resource budget and `autoscaling/v2` HPA live in the Argo CD GitOps repository so automatic self-heal preserves them.

**Tech Stack:** Kubernetes v1.28.15, Metrics Server v0.7.2, Helm templates, Argo CD, Kong Ingress, autoscaling/v2.

## Global Constraints

- All nodes must be Ready and free of DiskPressure before HPA validation.
- Metrics Server version is exactly v0.7.2.
- The target is `Deployment/demo-app/nginx-php` behind Kong NodePort 30080.
- HPA minimum replicas is 2, maximum replicas is 20, and average CPU utilization target is 60%.
- Scale-up stabilization is 0 seconds; scale-down stabilization is 300 seconds.
- Do not delete PVCs, application data, or unrelated workloads.

---

### Task 1: Establish a stable cluster prerequisite

**Files:**
- Read only: Kubernetes Node, Pod, Event, and filesystem-stat objects

**Interfaces:**
- Consumes: kubeconfig `/etc/kubernetes/admin.conf`
- Produces: a stable prerequisite with every Node Ready and `DiskPressure=False`

- [ ] **Step 1: Capture node conditions and current monitoring rollout**

Run:

```bash
export KUBECONFIG=/etc/kubernetes/admin.conf
kubectl get nodes -o custom-columns='NAME:.metadata.name,READY:.status.conditions[?(@.type=="Ready")].status,DISK:.status.conditions[?(@.type=="DiskPressure")].status'
kubectl get deploy,statefulset,daemonset -n monitoring
```

Expected: all five Nodes are Ready; wait without forcing taint removal while a Node reports DiskPressure.

- [ ] **Step 2: Verify monitoring control-plane dependencies**

Run:

```bash
kubectl get pods -n rook-ceph -l app=csi-rbdplugin -o wide
kubectl get pods -n monitoring -o wide
```

Expected: all five RBD CSI Pods are Ready. Loki, Grafana, Prometheus, node-exporter, and Fluentd desired Pods are Running and Ready; old terminal Pods may be reported separately but are not a readiness substitute.

### Task 2: Install and validate Metrics Server v0.7.2

**Files:**
- Download: `/home/user1/metrics-server-v0.7.2-components.yaml`
- Apply: upstream Metrics Server Kubernetes objects in `kube-system`

**Interfaces:**
- Consumes: upstream release URL `https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml`
- Produces: Available `APIService/v1beta1.metrics.k8s.io`

- [ ] **Step 1: Download the pinned upstream manifest**

Run:

```bash
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --output /home/user1/metrics-server-v0.7.2-components.yaml \
  https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
sha256sum /home/user1/metrics-server-v0.7.2-components.yaml
grep -F 'registry.k8s.io/metrics-server/metrics-server:v0.7.2' /home/user1/metrics-server-v0.7.2-components.yaml
```

Expected: a nonempty manifest containing exactly the v0.7.2 image reference; record its SHA-256 before applying.

- [ ] **Step 2: Perform server-side validation before mutation**

Run:

```bash
kubectl apply --server-side --dry-run=server \
  -f /home/user1/metrics-server-v0.7.2-components.yaml
```

Expected: every object validates without an error.

- [ ] **Step 3: Apply the upstream manifest**

Run:

```bash
kubectl apply -f /home/user1/metrics-server-v0.7.2-components.yaml
kubectl rollout status deployment/metrics-server -n kube-system --timeout=180s
```

Expected: Deployment rollout completes.

- [ ] **Step 4: Diagnose certificate failure before applying the lab exception**

Run:

```bash
kubectl get apiservice v1beta1.metrics.k8s.io
kubectl logs -n kube-system deployment/metrics-server --tail=100
```

Expected: if samples work, make no change. If logs contain an x509 kubelet certificate verification failure, add only `--kubelet-insecure-tls` to the existing Metrics Server args and wait for the new rollout.

- [ ] **Step 5: Verify fresh Metrics API samples**

Run:

```bash
kubectl wait --for=condition=Available apiservice/v1beta1.metrics.k8s.io --timeout=180s
kubectl top nodes
kubectl top pods -n demo-app
```

Expected: all commands return numeric CPU and memory values.

### Task 3: Add the application resource budget and HPA to GitOps

**Files:**
- Modify: `templates/nginx-php-kong.yaml`
- Create: `templates/nginx-php-hpa.yaml`

**Interfaces:**
- Consumes: existing `Deployment/demo-app/nginx-php` and labels `app: nginx-php`
- Produces: rendered CPU requests and `HorizontalPodAutoscaler/nginx-php`

- [ ] **Step 1: Capture a failing Helm-render assertion**

Run from `/home/user1/Babyfolio_Storage_Optimization`:

```bash
helm template apple-app . --namespace demo-app > /tmp/apple-app-before.yaml
grep -F 'kind: HorizontalPodAutoscaler' /tmp/apple-app-before.yaml
grep -F 'cpu: 100m' /tmp/apple-app-before.yaml
```

Expected: both assertions fail before the change.

- [ ] **Step 2: Add exact resource requests and limits**

Add to the `nginx` container in `templates/nginx-php-kong.yaml`:

```yaml
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

Add to the `php-fpm` container:

```yaml
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: "1"
              memory: 512Mi
```

- [ ] **Step 3: Create the HPA template**

Create `templates/nginx-php-hpa.yaml` with:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-php
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-php
  minReplicas: 2
  maxReplicas: 20
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      selectPolicy: Max
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
        - type: Pods
          value: 4
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      selectPolicy: Max
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

- [ ] **Step 4: Render and validate the changed chart**

Run:

```bash
helm lint .
helm template apple-app . --namespace demo-app > /tmp/apple-app-after.yaml
kubectl apply --dry-run=server -f /tmp/apple-app-after.yaml
grep -F 'kind: HorizontalPodAutoscaler' /tmp/apple-app-after.yaml
grep -F 'averageUtilization: 60' /tmp/apple-app-after.yaml
```

Expected: lint, server validation, and assertions pass.

- [ ] **Step 5: Commit and push the exact GitOps files**

Run:

```bash
git diff --check
git add -- templates/nginx-php-kong.yaml templates/nginx-php-hpa.yaml
git diff --cached --check
git commit -m 'feat: add demo app CPU autoscaling'
git push origin main
```

Expected: push succeeds without including unrelated files.

### Task 4: Verify Argo CD convergence and HPA readiness

**Files:**
- Read only: Argo CD Application, Deployment, HPA, Metrics API

**Interfaces:**
- Consumes: the pushed Git commit and Metrics API from Tasks 2 and 3
- Produces: numeric HPA target and a Ready two-replica baseline

- [ ] **Step 1: Wait for Argo CD to apply the commit**

Run:

```bash
kubectl get application -n argocd apple-app -o wide
kubectl rollout status deployment/nginx-php -n demo-app --timeout=180s
```

Expected: Application revision matches the pushed commit and the Deployment rollout completes.

- [ ] **Step 2: Verify the live resource contract**

Run:

```bash
kubectl get deployment -n demo-app nginx-php -o jsonpath='{range .spec.template.spec.containers[*]}{.name}{"="}{.resources}{"\n"}{end}'
kubectl get hpa -n demo-app nginx-php -o wide
kubectl describe hpa -n demo-app nginx-php
```

Expected: both containers have the designed requests and limits; HPA is min 2/max 20 and reports a numeric CPU target.

- [ ] **Step 3: Verify the Kong path without load**

Run from Core:

```bash
curl --fail --silent --show-error \
  --header 'Host: rakko.site' \
  http://172.16.8.144:30080/ >/dev/null
```

Expected: HTTP success with no Locust load yet.

- [ ] **Step 4: Commit the implementation evidence**

Record the Metrics manifest SHA-256, Git commit, Argo revision, Metrics API availability, Deployment rollout result, and HPA current target in the operations report. Do not claim HPA reaction time until a separate staged load run produces timing evidence.
