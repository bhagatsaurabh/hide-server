package me.saurabhagat.hide.auth_service.exception;

import lombok.Getter;

@Getter
public class InternalServerErrorException extends RuntimeException {
    private final String code;

    public InternalServerErrorException(String code) {
        super(code);
        this.code = code;
    }
}
