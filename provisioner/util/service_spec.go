package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

func GetServiceSpec(wsUuid string) *v1.Service {
	name := fmt.Sprintf("workspace-service-%s", wsUuid)
	serviceSpec := &v1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
		},
		Spec: v1.ServiceSpec{
			Selector: map[string]string{"app": name},
			Ports: []v1.ServicePort{
				{
					Protocol:   v1.ProtocolTCP,
					Port:       22,
					TargetPort: intstr.FromInt(22),
					Name:       "ssh",
				},
				{
					Protocol:   v1.ProtocolTCP,
					Port:       80,
					TargetPort: intstr.FromInt(80),
					Name:       "api",
				},
			},
			Type: v1.ServiceTypeClusterIP,
		},
	}

	return serviceSpec
}
