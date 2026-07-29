import * as kubernetes from "@pulumi/kubernetes";
import { readFileSync } from "fs";
import path = require("path");

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

const adminToken = new kubernetes.core.v1.Secret("admin-user-token", {
  apiVersion: "v1",
  kind: "Secret",
  type: "kubernetes.io/service-account-token",
  "metadata": {
    name: "admin-user-token",
    namespace: dashboardNamespace.metadata.name,
    annotations: {
      "kubernetes.io/service-account.name": serviceAccount.metadata.name,
    }
  }
});

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

const observabilityNamespace = new kubernetes.core.v1.Namespace(
  "observability",
  {
    metadata: {
      name: "observability",
    },
  },
);

const promethusAppName = "prometheus";
const configPath = path.join(__dirname, "prometheus.yml");
const prometheusConfigContent = readFileSync(configPath, "utf-8")
  .replaceAll("{{K3S_TOKEN}}", process.env.K3S_TOKEN ?? "");

const prometheusConfigSecret = new kubernetes.core.v1.Secret(`${promethusAppName}-config-secret`, {
  metadata: { namespace: observabilityNamespace.metadata.name },
  stringData: {
    "prometheus.yml": prometheusConfigContent,
  },
});

const prometheusPvc = new kubernetes.core.v1.PersistentVolumeClaim(`${promethusAppName}-storage`, {
  metadata: { namespace: observabilityNamespace.metadata.name },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: "8Gi",
      },
    },
  },
});

const prometheusDeployment = new kubernetes.apps.v1.Deployment(`${promethusAppName}-deployment`, {
  metadata: { namespace: observabilityNamespace.metadata.name },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: promethusAppName } },
    template: {
      metadata: { labels: { app: promethusAppName } },
      spec: {
        containers: [
          {
            name: "prometheus",
            image: "prom/prometheus:v3.13.1",
            args: [
              "--config.file=/etc/prometheus/prometheus.yml",
              "--storage.tsdb.path=/prometheus",
              "--storage.tsdb.retention.size=8GB"
            ],
            ports: [{ containerPort: 9090, name: "http" }],
            volumeMounts: [
              {
                name: "config-volume",
                mountPath: "/etc/prometheus",
              },
              {
                name: "storage-volume",
                mountPath: "/prometheus",
              }
            ],
          },
        ],
        volumes: [
          {
            name: "config-volume",
            secret: {
              secretName: prometheusConfigSecret.metadata.name,
            },
          },
          {
            name: "storage-volume",
            persistentVolumeClaim: {
              claimName: prometheusPvc.metadata.name,
            },
          },
        ],
      },
    },
  },
});

const prometheusService = new kubernetes.core.v1.Service(`${promethusAppName}-service`, {
  metadata: { namespace: observabilityNamespace.metadata.name },
  spec: {
    type: "NodePort",
    ports: [{ port: 9090, targetPort: 9090, name: "http" }],
    selector: { app: promethusAppName },
  },
});

const grafanaPvc = new kubernetes.core.v1.PersistentVolumeClaim("grafana-pvc", {
  metadata: {
    namespace: observabilityNamespace.metadata.name,
  },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: "5Gi",
      },
    },
  },
});

const grafanaGoogleAuthSecret = new kubernetes.core.v1.Secret("grafana-google-auth", {
  metadata: {
    name: "grafana-google-auth",
    namespace: observabilityNamespace.metadata.name,
  },
  stringData: {
    "client-id": process.env.GF_AUTH_GOOGLE_CLIENT_ID ?? "",
    "client-secret": process.env.GF_AUTH_GOOGLE_CLIENT_SECRET ?? "",
  },
});

const prometheusDatastorePath = path.join(__dirname, "prometheus-datastore.yml");
const prometheusDatastoreConfigContent = readFileSync(prometheusDatastorePath, "utf-8")

const grafanaDatasourceConfig = new kubernetes.core.v1.ConfigMap("grafana-datasource-config", {
  metadata: {
    namespace: observabilityNamespace.metadata.name,
    name: "grafana-datasource-config",
  },
  data: {
    "prometheus-datasource.yml": prometheusDatastoreConfigContent,
  },
});

const grafanaDeployment = new kubernetes.apps.v1.Deployment("grafana-deployment", {
  metadata: {
    namespace: observabilityNamespace.metadata.name,
    labels: {
      app: "grafana",
    },
  },
  spec: {
    replicas: 1,
    selector: {
      matchLabels: {
        app: "grafana",
      },
    },
    template: {
      metadata: {
        labels: {
          app: "grafana",
        },
      },
      spec: {
        containers: [
          {
            name: "grafana",
            image: "grafana/grafana:13.1.1",
            ports: [
              {
                containerPort: 3000,
              },
            ],
            env: [
              {
                name: "GF_SERVER_DOMAIN",
                value: "grafana.ridebeep.app"
              },
              {
                name: "GF_SERVER_ROOT_URL",
                value: "https://%(domain)s"
              },
              {
                name: "GF_AUTH_GOOGLE_NAME",
                value: "Google",
              },
              {
                name: "GF_AUTH_GOOGLE_ICON",
                value: "google",
              },
              {
                name: "GF_AUTH_GOOGLE_ENABLED",
                value: "true",
              },
              {
                name: "GF_AUTH_GOOGLE_ALLOW_SIGN_UP",
                value: "true",
              },
              {
                name: "GF_AUTH_GOOGLE_AUTO_LOGIN",
                value: "false",
              },
              {
                name: "GF_AUTH_GOOGLE_CLIENT_ID",
                valueFrom: {
                  secretKeyRef: {
                    name: grafanaGoogleAuthSecret.metadata.name,
                    key: "client-id",
                  },
                },
              },
              {
                name: "GF_AUTH_GOOGLE_CLIENT_SECRET",
                valueFrom: {
                  secretKeyRef: {
                    name: grafanaGoogleAuthSecret.metadata.name,
                    key: "client-secret",
                  },
                },
              },
              {
                name: "GF_AUTH_GOOGLE_SCOPES",
                value: "openid email profile",
              },
              {
                name: "GF_AUTH_GOOGLE_AUTH_URL",
                value: "https://accounts.google.com/o/oauth2/v2/auth",
              },
              {
                name: "GF_AUTH_GOOGLE_TOKEN_URL",
                value: "https://oauth2.googleapis.com/token",
              },
              {
                name: "GF_AUTH_GOOGLE_API_URL",
                value: "https://openidconnect.googleapis.com/v1/userinfo",
              },
              {
                name: "GF_AUTH_GOOGLE_ALLOWED_DOMAINS",
                value: "ridebeep.app",
              },
              {
                name: "GF_AUTH_GOOGLE_HOSTED_DOMAIN",
                value: "ridebeep.app",
              },
              {
                name: "GF_AUTH_GOOGLE_USE_PKCE",
                value: "true",
              },
              {
                name: "GF_AUTH_GOOGLE_SKIP_ORG_ROLE_SYNC",
                value: "false"
              },
              {
                name: "GF_AUTH_GOOGLE_ROLE_ATTRIBUTE_PATH",
                value: "email=='banks@ridebeep.app' && 'GrafanaAdmin' || 'Viewer'"
              },
              {
                name: "GF_AUTH_GOOGLE_ALLOW_ASSIGN_GRAFANA_ADMIN",
                value: "true"
              },
              {
                name: "GF_SECURITY_DISABLE_INITIAL_ADMIN_CREATION",
                value: "true",
              },
              {
                name: "GF_AUTH_DISABLE_LOGIN",
                value: "true",
              },
              {
                name: "GF_AUTH_DISABLE_LOGIN_FORM",
                value: "true",
              },
            ],
            volumeMounts: [
              {
                name: "storage",
                mountPath: "/var/lib/grafana",
              },
              {
                name: "grafana-datasources",
                mountPath: "/etc/grafana/provisioning/datasources",
              },
            ],
          },
        ],
        volumes: [
          {
            name: "storage",
            persistentVolumeClaim: {
              claimName: grafanaPvc.metadata.name,
            },
          },
          {
            name: "grafana-datasources",
            configMap: {
              name: grafanaDatasourceConfig.metadata.name,
            },
          },
        ],
      },
    },
  },
});

const grafanaService = new kubernetes.core.v1.Service("grafana-service", {
  metadata: {
    name: 'grafana-service',
    namespace: observabilityNamespace.metadata.name,
  },
  spec: {
    selector: { app: "grafana" },
    ports: [{ port: 3000, targetPort: 3000 }],
    type: "ClusterIP",
  },
});

const grafanaIngress = new kubernetes.networking.v1.Ingress(
  "grafana-ingress",
  {
    metadata: {
      name: "grafana-ingress",
      namespace: observabilityNamespace.metadata.name,
    },
    spec: {
      rules: [
        {
          host: "grafana.ridebeep.app",
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: grafanaService.metadata.name,
                    port: { number: 3000 },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
);
