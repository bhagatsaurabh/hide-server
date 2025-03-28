package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetPodSpec(workspaceUUID string, image string, publicKey string) *v1.Pod {
	podSpec := &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name: fmt.Sprintf("workspace-%s", workspaceUUID),
		},
		Spec: v1.PodSpec{
			Containers: []v1.Container{
				{
					Name:            "dev",
					Image:           image,
					ImagePullPolicy: v1.PullNever,
					/* Command: []string{
						"/bin/sh", "-c",
						"mkdir -p /home/devuser/.ssh && echo \"$SSH_PUBLIC_KEY\" > /home/devuser/.ssh/authorized_keys && chmod 600 /home/devuser/.ssh/authorized_keys && exec /usr/sbin/sshd -D",
					}, */
					Env: []v1.EnvVar{
						{
							Name:  "SSH_PUBLIC_KEY",
							Value: publicKey,
						},
					},
				},
			},
		},
	}

	return podSpec
}
