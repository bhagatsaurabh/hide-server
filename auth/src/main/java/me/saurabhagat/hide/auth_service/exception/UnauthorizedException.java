package me.saurabhagat.hide.auth_service.exception;

import lombok.Getter;

@Getter
public class UnauthorizedException extends RuntimeException {
    private final String code;

    public UnauthorizedException(String code) {
        super(code);
        this.code = code;
    }
}

