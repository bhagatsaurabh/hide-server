package util

import (
	"fmt"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func GetPersistentVolumeSpec(wsUuid string, volumeName string, storageQty resource.Quantity) *v1.PersistentVolume {
	hostPathType := v1.HostPathDirectoryOrCreate
	pv := &v1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:      volumeName,
			Namespace: "default",
		},
		Spec: v1.PersistentVolumeSpec{
			StorageClassName: "local-path",
			Capacity: v1.ResourceList{
				v1.ResourceStorage: storageQty,
			},
			AccessModes: []v1.PersistentVolumeAccessMode{
				v1.ReadWriteOnce,
			},
			PersistentVolumeSource: v1.PersistentVolumeSource{
				HostPath: &v1.HostPathVolumeSource{
					Path: fmt.Sprintf("/var/lib/k8s-volumes/%s", volumeName),
					Type: &hostPathType,
				},
			},
			PersistentVolumeReclaimPolicy: v1.PersistentVolumeReclaimRetain,
		},
	}
	return pv
}

func GetPersistentVolumeClaimSpec(volumeName string, storageQty resource.Quantity) *v1.PersistentVolumeClaim {
	pvc := &v1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:      volumeName,
			Namespace: "default",
		},
		Spec: v1.PersistentVolumeClaimSpec{
			VolumeName: volumeName,
			AccessModes: []v1.PersistentVolumeAccessMode{
				v1.ReadWriteOnce,
			},
			Resources: v1.VolumeResourceRequirements{
				Requests: v1.ResourceList{
					v1.ResourceStorage: storageQty,
				},
			},
		},
	}
	return pvc
}
