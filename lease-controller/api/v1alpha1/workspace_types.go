package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type WorkspaceSpec struct {
	LeaseExpiry metav1.Time `json:"leaseExpiry"`
	PodName     string      `json:"podName"`
	Uid         string      `json:"uid"`
}

type WorkspaceStatus struct {
	State string `json:"state,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status

type Workspace struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitzero"`
	Spec              WorkspaceSpec   `json:"spec"`
	Status            WorkspaceStatus `json:"status,omitzero"`
}

// +kubebuilder:object:root=true
type WorkspaceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitzero"`
	Items           []Workspace `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Workspace{}, &WorkspaceList{})
}
