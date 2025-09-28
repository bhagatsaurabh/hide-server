import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';

export const loadK8sConfig = () => {
  const kc = new KubeConfig();
  kc.loadFromDefault();
  return kc.makeApiClient(CoreV1Api);
};
