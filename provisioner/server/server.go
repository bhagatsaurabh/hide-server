package server

import (
	"hideserver/provisioner/handlers/commithndl"
	"hideserver/provisioner/handlers/provisionhndl"
	"net/http"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer() *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/provision", provisionhndl.ProvisionHandler)
	mux.HandleFunc("/api/commit", commithndl.CommitHandler)

	return &Server{Router: mux}
}
