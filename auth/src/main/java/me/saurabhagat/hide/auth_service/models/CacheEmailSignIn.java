package me.saurabhagat.hide.auth_service.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class CacheEmailSignIn {
    @JsonProperty
    int reqAttemptCount;

    @JsonProperty
    int verifyAttemptCount;

    @JsonProperty
    String pin;
}
