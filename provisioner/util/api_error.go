package util

import (
	"encoding/json"
	"net/http"
	"time"

	log "github.com/sirupsen/logrus"
)

type APIErr struct {
	Status    int    `json:"status"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func SendAPIErr(w http.ResponseWriter, status int, message string) {
	log.Debugf("API Err: %d %s", status, message)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	errRes := APIErr{
		Status:    status,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	json.NewEncoder(w).Encode(errRes)
}
