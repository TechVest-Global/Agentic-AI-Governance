from pydantic import BaseModel, Field, field_validator


class SignInRequest(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class SignUpRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(max_length=254)
    role: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("email")
    @classmethod
    def email_must_look_like_email(cls, value: str) -> str:
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Enter a valid email address.")
        return value


class AuthUserRead(BaseModel):
    id: str
    email: str
    name: str
    role: str
    initials: str


class AuthResponse(BaseModel):
    user: AuthUserRead
    token: str
