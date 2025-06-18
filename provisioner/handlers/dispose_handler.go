package handlers

import (
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"net/http"
	"os"
)

func DisposeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	if err := services.DisposeDevContainer(uuid, devEnv); err != nil {
		util.SendAPIErr(w, http.StatusInternalServerError, "Could not de-provision workspace")
		return
	}

	w.WriteHeader(http.StatusOK)
}
