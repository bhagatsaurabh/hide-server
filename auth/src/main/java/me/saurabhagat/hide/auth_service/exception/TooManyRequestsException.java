package me.saurabhagat.hide.auth_service.exception;

import lombok.Getter;

@Getter
public class TooManyRequestsException extends RuntimeException {
    private final String code;

    public TooManyRequestsException(String code) {
        super(code);
        this.code = code;
    }
}

