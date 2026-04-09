// import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

// const config = new pulumi.Config();

// Create a namespace
const dashboardNamespace = new kubernetes.core.v1.Namespace(
  "kubernetes-dashboard",
  {
    metadata: {
      name: "kubernetes-dashboard",
    },
  },
);

// Use Helm to install the Kubernets dashboard
const headlamp = new kubernetes.helm.v3.Release("headlamp", {
  chart: "headlamp",
  namespace: dashboardNamespace.metadata.name,
  repositoryOpts: {
    repo: "https://kubernetes-sigs.github.io/headlamp/",
  },
  createNamespace: true,
  version: "0.41.0",
  values: {
    service: {
      type: "NodePort",
    },
  },
});

const serviceAccount = new kubernetes.core.v1.ServiceAccount("admin-user", {
  metadata: {
    name: "admin-user",
    namespace: dashboardNamespace.metadata.name,
  },
});

const serviceAccountRoleBining = new kubernetes.rbac.v1.ClusterRoleBinding(
  "admin-role-binding",
  {
    metadata: {
      name: "admin-role-binding",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "cluster-admin",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.metadata.name,
        namespace: dashboardNamespace.metadata.name,
      },
    ],
  },
);

const traefikConfig = `
ingressRoute:
  dashboard:
    enabled: true
ports:
  traefik:
    expose:
      default: true
  metrics:
    expose:
      default: true
`.trim();

const traefikHelmChartConfig = new kubernetes.apiextensions.CustomResource(
  "traefik-helmchartconfig",
  {
    apiVersion: "helm.cattle.io/v1",
    kind: "HelmChartConfig",
    metadata: {
      name: "traefik",
      namespace: "kube-system",
    },
    spec: {
      valuesContent: traefikConfig,
    },
  },
);
