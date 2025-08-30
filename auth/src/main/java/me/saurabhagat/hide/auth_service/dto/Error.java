package me.saurabhagat.hide.auth_service.dto;

import lombok.Getter;
import org.springframework.http.HttpStatus;

@Getter
public class Error {
    private final int statusCode;
    private final String timestamp;
    private final String message;

    public Error(String message, HttpStatus statusCode) {
        this.statusCode = statusCode.value();
        this.timestamp = java.time.OffsetDateTime.now().toString();
        this.message = message;
    }
}
