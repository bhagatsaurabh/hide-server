package commithndl

import (
	"hideserver/provisioner/services/commitsvc"
	"hideserver/provisioner/util"
	"log"
	"net/http"
	"os"
)

type UserHeader struct {
	Uid      string `json:"uid"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Picture  string `json:"picture"`
	Issuer   string `json:"issuer"`
}

func CommitHandler(w http.ResponseWriter, r *http.Request) {
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
		err = commitsvc.CommitDockerImage(uuid, baseImage)
	} else {
		err = commitsvc.CommitK8sImage(uuid, baseImage, devEnv)
	}
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to commit dev container")
		return
	}

	w.WriteHeader(http.StatusAccepted)
}
