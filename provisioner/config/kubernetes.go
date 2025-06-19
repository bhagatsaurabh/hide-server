package config

import (
	"log"
	"os"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

var config *rest.Config
var k8sErr error = nil
var isk8sConfigLoaded = false

func LoadK8sConfig() (*rest.Config, error) {
	if isk8sConfigLoaded {
		return config, k8sErr
	}

	if _, exists := os.LookupEnv("KUBERNETES_SERVICE_HOST"); exists {
		log.Println("Using in-cluster config.")
		config, k8sErr = rest.InClusterConfig()
	} else {
		k8sAPIServer := os.Getenv("K8S_API_SERVER")
		kubeconfigPath := homedir.HomeDir() + "/.kube/config"
		log.Println(kubeconfigPath)
		log.Printf("Using config from %s and K8s API server at: %s", kubeconfigPath, k8sAPIServer)
		config, k8sErr = clientcmd.BuildConfigFromFlags(k8sAPIServer, kubeconfigPath)
	}

	if k8sErr == nil {
		isk8sConfigLoaded = true
	}
	return config, nil
}
