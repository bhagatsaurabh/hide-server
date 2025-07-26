package handlers

import (
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"net/http"
	"os"
)

func DeleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	uuid := r.URL.Query().Get("uuid")
	if uuid == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request, missing workspace uuid")
		return
	}

	devEnv, _ := os.LookupEnv("DEV_PLATFORM")

	go services.DeleteDevContainer(uuid, devEnv)

	w.WriteHeader(http.StatusAccepted)
}
