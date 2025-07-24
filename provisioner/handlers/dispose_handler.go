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

	go services.DisposeDevContainer(uuid, devEnv)

	w.WriteHeader(http.StatusOK)
}
