package commithndl

import (
	"encoding/base64"
	"encoding/json"
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
	var req commitsvc.CommitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid request")
		return
	}
	if req.Uuid == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing field: uuid")
		return
	}
	userHeader := r.Header.Get("x-auth-user")
	if userHeader == "" {
		util.SendAPIErr(w, http.StatusBadRequest, "Missing x-auth-user header")
		return
	}
	decodedBytes, err := base64.StdEncoding.DecodeString(userHeader)
	if err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid Base64 encoding in x-auth-user header")
		return
	}
	var user UserHeader
	err = json.Unmarshal(decodedBytes, &user)
	if err != nil {
		util.SendAPIErr(w, http.StatusBadRequest, "Invalid JSON in x-auth-user header")
		return
	}

	if devEnv, exists := os.LookupEnv("DEV_PLATFORM"); exists && devEnv == "docker" {
		err = commitsvc.CommitDockerImage(req)
	} else {
		err = commitsvc.CommitK8sImage(req, devEnv)
	}
	if err != nil {
		log.Println(err.Error())
		util.SendAPIErr(w, http.StatusInternalServerError, "Failed to commit dev container")
		return
	}

	w.WriteHeader(http.StatusCreated)
}
