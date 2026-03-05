export type Config = {
  port: number;
  functionsDir: string;
  containerNamePrefix: string;
  dockerImagePullOnRegister: boolean;
  runAsUser: string | null;
};

export type FunctionEntry = {
  name: string;
  image: string;
  path: string;
};

export type InvokeRequest = {
  body: unknown;
  metadata?: Record<string, unknown>;
};

export type RegisterPayload = {
  name?: string;
  image?: string;
  code?: string;
};
