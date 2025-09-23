package handlers

import (
	"context"
	"hideserver/provisioner/services"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
)

func CommitHandler(bgCtx context.Context, w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		util.SendAPIErr(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	uuid := r.URL.Query().Get("uuid")
	baseImage := r.URL.Query().Get("baseImage")
	if uuid == "" || baseImage == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		return
	}

	var err error
	if devEnv, exists := os.LookupEnv("DEV_PLATFORM"); exists && devEnv == "docker" {
		err = services.CommitDockerImage(bgCtx, uuid, baseImage)
	} else {
		err = services.CommitK8sImage(bgCtx, uuid, baseImage, devEnv)
	}
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to commit dev container")
		return
	}

	w.WriteHeader(http.StatusAccepted)
}
