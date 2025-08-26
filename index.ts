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
const ingressController = new kubernetes.helm.v3.Release(
  "kubernetes-dashboard",
  {
    chart: "kubernetes-dashboard",
    namespace: dashboardNamespace.metadata.name,
    repositoryOpts: {
      repo: "https://kubernetes.github.io/dashboard/",
    },
    createNamespace: true,
    version: "7.13.0",
    values: {
      kong: {
        proxy: {
          type: "NodePort",
        },
      },
    },
  },
);

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

// install cloud native PG for databases
const cnpg = new kubernetes.yaml.ConfigFile("cloudnative-pg", {
  file: "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.27/releases/cnpg-1.27.0.yaml",
});

const traefikConfig = `
    dashboard:
      enabled: true
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
