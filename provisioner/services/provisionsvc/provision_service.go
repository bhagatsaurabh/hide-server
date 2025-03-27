package provisionsvc

import (
	"context"
	"hideserver/provisioner/config"
	"log"
	"time"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

type ProvisionRequest struct {
	Image string `json:"image"`
}

func CreateK8sPod(req ProvisionRequest) error {
	config, err := config.LoadK8sConfig()

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		log.Println("Error creating Kubernetes client:", err)
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pod := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: /* req.PodName */ "uwu",
		},
		Spec: v1.PodSpec{
			Containers: []v1.Container{
				{
					Name: "uwu",
					Image:/* req.Image */ "hide-node:latest",
					ImagePullPolicy: v1.PullNever,
				},
			},
		},
	}

	_, err = clientset.CoreV1().Pods( /* req.Namespace */ "default").Create(ctx, pod, metav1.CreateOptions{})
	return err
}
