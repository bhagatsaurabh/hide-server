package handlers

import (
	"context"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
	"time"
)

func DisposeHandler(sysCtx context.Context, w http.ResponseWriter, r *http.Request) {
	bgCtx, cancel := context.WithTimeout(sysCtx, 2*time.Minute)

	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "WORKSPACE_DISPOSE_INVALID_REQUEST")
		cancel()
		return
	}
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "WORKSPACE_DISPOSE_INVALID_REQUEST")
		cancel()
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	go func() {
		defer cancel()
		if err := services.DisposeDevContainer(bgCtx, uuid, devEnv); err != nil {
			log.Printf("Dispose failed: %v", err)
		}
	}()

	w.WriteHeader(http.StatusOK)
}
