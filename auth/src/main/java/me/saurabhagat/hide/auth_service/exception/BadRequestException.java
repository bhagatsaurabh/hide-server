package me.saurabhagat.hide.auth_service.exception;

import lombok.Getter;

@Getter
public class BadRequestException extends RuntimeException {
    private final String code;

    public BadRequestException(String code) {
        super(code);
        this.code = code;
    }
}
