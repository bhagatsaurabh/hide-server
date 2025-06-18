package server

import (
	"hideserver/provisioner/handlers"
	"net/http"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer() *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/provision", handlers.ProvisionHandler)
	mux.HandleFunc("/api/commit", handlers.CommitHandler) // TODO
	mux.HandleFunc("/api/dispose", handlers.DisposeHandler)

	return &Server{Router: mux}
}
