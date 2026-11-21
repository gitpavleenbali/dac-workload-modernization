import fs from 'node:fs';
import path from 'node:path';

/**
 * Extract workload deployment units (VM systemd services, Dockerfile, Kubernetes manifests)
 * and OpenAPI endpoint contracts without external YAML parser dependencies.
 */
export function extractWorkloadsAndApi(repoRoot) {
  const workloads = [];
  const apiEndpoints = [];

  // 1. Check systemd unit files (VM IaaS hosting artifacts)
  const systemdDir = path.join(repoRoot, 'deploy', 'systemd');
  if (fs.existsSync(systemdDir)) {
    for (const file of fs.readdirSync(systemdDir).filter((f) => f.endsWith('.service')).sort()) {
      const content = fs.readFileSync(path.join(systemdDir, file), 'utf8');
      const desc = content.match(/^Description=(.+)$/m)?.[1]?.trim() || file;
      const execStart = content.match(/^ExecStart=(.+)$/m)?.[1]?.trim() || '';
      const user = content.match(/^User=(.+)$/m)?.[1]?.trim() || 'root';
      workloads.push({
        name: file.replace(/\.service$/, ''),
        kind: 'systemd-service',
        runtime: 'vm-systemd',
        replicas: '1 per VM',
        artifact: execStart,
        identity: `OS user: ${user} + VM System Managed Identity`,
        exposure: 'TCP 8080 via Azure Standard Load Balancer'
      });
      void desc;
    }
  }

  // 2. Check Dockerfile + Kubernetes manifests (AKS Cloud-Native hosting artifacts)
  const dockerfilePath = path.join(repoRoot, 'Dockerfile');
  const hasDockerfile = fs.existsSync(dockerfilePath);
  let baseImage = null;
  if (hasDockerfile) {
    const df = fs.readFileSync(dockerfilePath, 'utf8');
    const fromLines = [...df.matchAll(/^FROM\s+([^\s]+)/gm)];
    baseImage = fromLines.at(-1)?.[1] || 'node:24-alpine';
  }

  const k8sDirs = [path.join(repoRoot, 'k8s'), path.join(repoRoot, 'deploy', 'k8s')];
  let hpaSpec = null;
  let ingressSpec = null;
  let csiVault = null;

  for (const kDir of k8sDirs) {
    if (!fs.existsSync(kDir)) continue;
    const ymlFiles = fs
      .readdirSync(kDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();

    const docs = [];
    for (const f of ymlFiles) {
      const raw = fs.readFileSync(path.join(kDir, f), 'utf8');
      for (const part of raw.split(/^---\s*$/m)) {
        if (part.trim()) docs.push(part);
      }
    }

    for (const doc of docs) {
      const kind = doc.match(/^kind:\s*([^\s#]+)/m)?.[1];
      const metaName = doc.match(/metadata:\s*\r?\n(?:.*\r?\n)*?\s*name:\s*([^\s#]+)/m)?.[1] || 'workload';
      if (kind === 'HorizontalPodAutoscaler') {
        const minR = doc.match(/minReplicas:\s*(\d+)/)?.[1] || '2';
        const maxR = doc.match(/maxReplicas:\s*(\d+)/)?.[1] || '10';
        hpaSpec = `HPA ${minR}-${maxR} pods`;
      } else if (kind === 'Ingress') {
        const host = doc.match(/-\s*host:\s*([^\s#]+)/)?.[1] || 'api.internal';
        const cls = doc.match(/ingressClassName:\s*([^\s#]+)/)?.[1] || 'azure-application-gateway';
        ingressSpec = `HTTPS ${host} (${cls})`;
      } else if (kind === 'SecretProviderClass') {
        csiVault = doc.match(/keyvaultName:\s*"?([^"\s#]+)"?/)?.[1] || 'kv-csi';
      }
      void metaName;
    }

    for (const doc of docs) {
      const kind = doc.match(/^kind:\s*([^\s#]+)/m)?.[1];
      if (kind === 'Deployment') {
        const name = doc.match(/metadata:\s*\r?\n\s*name:\s*([^\s#]+)/m)?.[1] || 'grid-telemetry-api';
        const replicas = doc.match(/replicas:\s*(\d+)/)?.[1] || '3';
        const image = doc.match(/image:\s*"?([^"\s#]+)"?/)?.[1] || (baseImage ? `acr/${name}:latest` : 'container');
        const sa = doc.match(/serviceAccountName:\s*([^\s#]+)/)?.[1] || 'default';
        workloads.push({
          name,
          kind: 'k8s-deployment',
          runtime: 'kubernetes',
          replicas: hpaSpec ? `${replicas} (${hpaSpec})` : `${replicas} pods`,
          artifact: image,
          identity: `ServiceAccount: ${sa}${csiVault ? ` + Key Vault CSI (${csiVault})` : ''}`,
          exposure: ingressSpec || 'ClusterIP / Ingress'
        });
      }
    }
  }

  // 3. Extract OpenAPI paths
  const openApiCandidates = [
    path.join(repoRoot, 'openapi', 'openapi.yaml'),
    path.join(repoRoot, 'openapi.yaml')
  ];
  for (const oaPath of openApiCandidates) {
    if (!fs.existsSync(oaPath)) continue;
    const raw = fs.readFileSync(oaPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let inPaths = false;
    let currentPath = null;
    let currentMethod = null;
    for (const line of lines) {
      if (/^paths:\s*$/.test(line)) {
        inPaths = true;
        continue;
      }
      if (inPaths && /^[A-Za-z0-9_-]+:/.test(line)) {
        inPaths = false;
        continue;
      }
      if (!inPaths) continue;
      const pathMatch = line.match(/^\s{2}(\/[^\s:]+):\s*$/);
      if (pathMatch) {
        currentPath = pathMatch[1];
        currentMethod = null;
        continue;
      }
      const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete):\s*$/i);
      if (methodMatch && currentPath) {
        currentMethod = methodMatch[1].toUpperCase();
        apiEndpoints.push({
          method: currentMethod,
          path: currentPath,
          summary: ''
        });
        continue;
      }
      const summaryMatch = line.match(/^\s{6}summary:\s*"?([^"\r\n]+)"?\s*$/);
      if (summaryMatch && currentMethod && apiEndpoints.length > 0) {
        apiEndpoints[apiEndpoints.length - 1].summary = summaryMatch[1].trim();
      }
    }
    break;
  }

  return { workloads, apiEndpoints, hasDockerfile, baseImage };
}
