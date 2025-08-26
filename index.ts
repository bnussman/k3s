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

const traefikDashboardService = new kubernetes.core.v1.Service(
  "traefik-dashboard-service",
  {
    metadata: {
      name: "traefik-dashboard",
      namespace: "kube-system",
      labels: {
        "app.kubernetes.io/instance": "traefik",
        "app.kubernetes.io/name": "traefik-dashboard",
      },
    },
    spec: {
      type: "ClusterIP",
      ports: [
        {
          name: "traefik",
          port: 9000,
          targetPort: "traefik",
          protocol: "TCP",
        },
      ],
      selector: {
        "app.kubernetes.io/instance": "traefik-kube-system",
        "app.kubernetes.io/name": "traefik",
      },
    },
  },
);

const traefikIngress = new kubernetes.networking.v1.Ingress("traefik-ingress", {
  metadata: {
    name: "traefik-ingress",
    namespace: "kube-system",
    annotations: {
      "spec.ingressClassName": "traefik",
    },
  },
  spec: {
    rules: [
      {
        http: {
          paths: [
            {
              path: "/",
              pathType: "Prefix",
              backend: {
                service: {
                  name: traefikDashboardService.metadata.name,
                  port: {
                    number: 9000,
                  },
                },
              },
            },
          ],
        },
      },
    ],
  },
});

// install cloud native PG for databases
const cnpg = new kubernetes.yaml.ConfigFile("cloudnative-pg", {
  file: "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.27/releases/cnpg-1.27.0.yaml",
});
