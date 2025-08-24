console.log(process.env);

import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

const config = new pulumi.Config();

if (!process.env.KUBECONFIG) {
  throw new Error("KUBECONFIG environment variable is not set");
}

const provider = new kubernetes.Provider("kubernetes", {
  kubeconfig: (process.env.KUBECONFIG as string).trim(),
});

// Create a namespace
const dashboardNamespace = new kubernetes.core.v1.Namespace(
  "kubernetes-dashboard",
  {
    metadata: {
      name: "kubernetes-dashboard",
    },
  },
  { provider },
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
  { provider },
);

const serviceAccount = new kubernetes.core.v1.ServiceAccount(
  "admin-user",
  {
    metadata: {
      name: "admin-user",
      namespace: dashboardNamespace.metadata.name,
    },
  },
  { provider },
);

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
  { provider },
);

// install cloud native PG for databases
const cnpg = new kubernetes.yaml.ConfigFile(
  "cloudnative-pg",
  {
    file: "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.27/releases/cnpg-1.27.0.yaml",
  },
  { provider },
);
