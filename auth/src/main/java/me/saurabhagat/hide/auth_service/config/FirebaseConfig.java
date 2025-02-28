package me.saurabhagat.hide.auth_service.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Base64;
import java.util.Objects;

@Slf4j
@Configuration
public class FirebaseConfig {
    @Value("${firebase.auth.emulator.host:}")
    String authEmulator;

    @Value("${firebase.admin.key:}")
    private Resource firebaseKeyPath;

    @Value("${firebase.admin.key.base64:}")
    private String firebaseKeyBase64;

    @Bean
    public FirebaseApp firebaseApp() throws IOException {
        if (authEmulator != null) {
            log.info("Using firebase auth emulator at {}", authEmulator);
        }
        FirebaseOptions options;
        if (Objects.nonNull(firebaseKeyPath) && firebaseKeyPath.exists()) {
            try (var inputStream = firebaseKeyPath.getInputStream()) {
                options = FirebaseOptions.builder()
                        .setCredentials(GoogleCredentials.fromStream(inputStream))
                        .build();
            }
        } else if (Objects.nonNull(firebaseKeyBase64) && !firebaseKeyBase64.isEmpty()) {
            byte[] decodedBytes = Base64.getDecoder().decode(firebaseKeyBase64);
            options = FirebaseOptions.builder()
                    .setCredentials(GoogleCredentials.fromStream(new ByteArrayInputStream(decodedBytes)))
                    .build();
        } else {
            throw new RuntimeException("Firebase credentials not found");
        }
        return FirebaseApp.initializeApp(options);
    }
}