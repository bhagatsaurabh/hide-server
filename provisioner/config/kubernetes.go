package config

import (
	"log"
	"os"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

func LoadK8sConfig() (*rest.Config, error) {
	var config *rest.Config
	var err error

	if _, exists := os.LookupEnv("KUBERNETES_SERVICE_HOST"); exists {
		log.Println("Using in-cluster config.")
		config, err = rest.InClusterConfig()
	} else {
		k8sAPIServer := os.Getenv("K8S_API_SERVER")
		kubeconfigPath := homedir.HomeDir() + "/.kube/config"
		log.Println(kubeconfigPath)
		log.Printf("Using config from %s and K8s API server at: %s", kubeconfigPath, k8sAPIServer)
		config, err = clientcmd.BuildConfigFromFlags(k8sAPIServer, kubeconfigPath)
	}

	if err != nil {
		log.Fatalf("Failed to load Kubernetes config: %v", err)
		return nil, err
	}

	/* 	clientset, err := kubernetes.NewForConfig(config)
	   	if err != nil {
	   		log.Fatalf("Failed to create Kubernetes client: %v", err)
	   		return nil, err
	   	} */

	return config, nil
}
