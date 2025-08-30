package me.saurabhagat.hide.auth_service.controller;

import me.saurabhagat.hide.auth_service.exception.BadRequestException;
import me.saurabhagat.hide.auth_service.service.AuthService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.Objects;

@RestController
@RequestMapping("api")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/validate")
    public ResponseEntity<?> validateToken(@RequestHeader(HttpHeaders.AUTHORIZATION) String authHeader) {
        var token = extractToken(authHeader);
        if (Objects.isNull(token)) {
            throw new BadRequestException("INVALID_AUTH_HEADER");
        }

        var user = authService.validateToken(token);

        return ResponseEntity.ok(user);
    }

    @GetMapping("/register-email")
    public ResponseEntity<?> registerEmail(@RequestParam(name = "email") String email) throws IOException {
        authService.registerEmail(email);
        return ResponseEntity.ok(null);
    }

    private String extractToken(String authHeader) {
        if (Objects.nonNull(authHeader) && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }
}
