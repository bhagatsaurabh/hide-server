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

func DeleteHandler(sysCtx context.Context, w http.ResponseWriter, r *http.Request) {
	bgCtx, cancel := context.WithTimeout(sysCtx, 2*time.Minute)

	if r.Method != http.MethodDelete {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		cancel()
		return
	}
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request, missing workspace uuid")
		cancel()
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	go func() {
		defer cancel()
		if err := services.DeleteDevContainer(bgCtx, uuid, devEnv); err != nil {
			log.Printf("Delete failed: %v", err)
		}
	}()

	w.WriteHeader(http.StatusAccepted)
}
