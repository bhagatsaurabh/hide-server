package controller

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	workspacev1alpha1 "hideserver/lease-controller/api/v1alpha1"
)

type WorkspaceReconciler struct {
	client.Client
	Scheme *runtime.Scheme
}

// +kubebuilder:rbac:groups=workspace.hideserver,resources=workspaces,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=workspace.hideserver,resources=workspaces/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=workspace.hideserver,resources=workspaces/finalizers,verbs=update
func (r *WorkspaceReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := logf.FromContext(ctx)

	var dev workspacev1alpha1.Workspace
	if err := r.Get(ctx, req.NamespacedName, &dev); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	now := time.Now()
	expiry := dev.Spec.LeaseExpiry.Time

	if now.After(expiry) {
		logger.Info("Lease expired, downgrading to spot", dev.Name)

		var pod corev1.Pod
		if err := r.Get(ctx, types.NamespacedName{Name: dev.Spec.PodName, Namespace: dev.Namespace}, &pod); err == nil {
			patch := client.MergeFrom(pod.DeepCopy())
			if pod.Labels == nil {
				pod.Labels = map[string]string{}
			}
			pod.Labels["wstype"] = "spot"
			if err := r.Patch(ctx, &pod, patch); err != nil {
				logger.Error(err, "Failed to patch pod label")
			}
		}

		go r.notify(dev)

		if err := r.Delete(ctx, &dev); err != nil {
			logger.Error(err, "Failed to delete Workspace CRD")
		}

		return ctrl.Result{}, nil
	}

	return ctrl.Result{RequeueAfter: expiry.Sub(now)}, nil
}

func (r *WorkspaceReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&workspacev1alpha1.Workspace{}).
		Named("workspace").
		Complete(r)
}

func (r *WorkspaceReconciler) notify(dev workspacev1alpha1.Workspace) {
	url := "http://workspace/api/downgrade"
	body := fmt.Sprintf(`{"uid":"%s","uuid":"%s"}`, dev.Spec.Uid, strings.TrimPrefix(dev.Name, "workspace-"))
	_, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		fmt.Printf("Failed to call downgrade API: %v\n", err)
	}
}
