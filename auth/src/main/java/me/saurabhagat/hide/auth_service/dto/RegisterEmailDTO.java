package me.saurabhagat.hide.auth_service.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RegisterEmailDTO {
    @JsonProperty
    String email;
}
