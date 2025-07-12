package server

import (
	"hideserver/provisioner/handlers"
	"net/http"

	"github.com/redis/go-redis/v9"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer(redisClient *redis.Client) *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/provision", func(w http.ResponseWriter, r *http.Request) { handlers.ProvisionHandler(w, r, redisClient) })
	mux.HandleFunc("/api/commit", handlers.CommitHandler)
	mux.HandleFunc("/api/dispose", handlers.DisposeHandler)

	return &Server{Router: mux}
}
