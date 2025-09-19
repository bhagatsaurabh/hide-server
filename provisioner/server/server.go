package server

import (
	"hideserver/provisioner/handlers"
	"net/http"

	"github.com/nats-io/nats.go"
	"github.com/redis/go-redis/v9"
)

type Server struct {
	Router *http.ServeMux
}

func NewServer(redisClient *redis.Client, natsClient *nats.Conn) *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/api/provision", func(w http.ResponseWriter, r *http.Request) { handlers.ProvisionHandler(w, r, redisClient, natsClient) })
	mux.HandleFunc("/api/commit", handlers.CommitHandler)
	mux.HandleFunc("/api/dispose", handlers.DisposeHandler)
	mux.HandleFunc("/api/delete", handlers.DeleteHandler)

	return &Server{Router: mux}
}
