package util

import (
	"fmt"

	v1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetCleanupJobSpec(wsUuid string) *v1.Job {
	priviledged := true
	hostPathType := corev1.HostPathDirectoryOrCreate
	mountPropagation := corev1.MountPropagationBidirectional
	job := &v1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      fmt.Sprintf("cleanup-volume-%s", wsUuid),
			Namespace: "default",
		},
		Spec: v1.JobSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					Containers: []corev1.Container{
						{
							Name:            "cleaner",
							Image:           "hideregistry.azurecr.io/hide-server-util-lvm:latest",
							SecurityContext: &corev1.SecurityContext{Privileged: &priviledged},
							VolumeMounts: []corev1.VolumeMount{
								{
									Name:             "host-volumes",
									MountPath:        "/host-volumes",
									MountPropagation: &mountPropagation,
								},
							},
							Env: []corev1.EnvVar{
								{Name: "WORKSPACE_UUID", Value: wsUuid},
							},
							Command: []string{"/bin/bash", "-c"},
							Args: []string{`
								set -eux

								WORKSPACE_DIR=/host-volumes/workspaces/$WORKSPACE_UUID

								touch /host-volumes/.delete-$WORKSPACE_UUID

								umount "$WORKSPACE_DIR/data" 2>/dev/null || umount -l "$WORKSPACE_DIR/data" || true
								umount "$WORKSPACE_DIR/config" 2>/dev/null || umount -l "$WORKSPACE_DIR/config" || true

								sleep 1

								lvchange -an /dev/workspace-vg/$WORKSPACE_UUID-data || true
								lvchange -an /dev/workspace-vg/$WORKSPACE_UUID-config || true

								udevadm settle || true
								sync
								sleep 1

								lvremove -f /dev/workspace-vg/$WORKSPACE_UUID-data || true
								lvremove -f /dev/workspace-vg/$WORKSPACE_UUID-config || true

								udevadm settle || true
								sleep 1

								rm -rf $WORKSPACE_DIR
								rm -f /host-volumes/.delete-$WORKSPACE_UUID
								`},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "host-volumes",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: "/data/workspace-volumes",
									Type: &hostPathType,
								},
							},
						},
					},
					ImagePullSecrets: []corev1.LocalObjectReference{
						{
							Name: "acr-secret",
						},
					},
				},
			},
		},
	}
	return job
}
