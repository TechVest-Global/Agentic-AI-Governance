class ApplicationError(Exception):
    """Expected application failure that can be returned to an API caller."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class ResourceNotFoundError(ApplicationError):
    def __init__(self, resource: str, resource_id: str) -> None:
        super().__init__(
            status_code=404,
            code="RESOURCE_NOT_FOUND",
            message=f"{resource} was not found.",
            details={"resource": resource, "id": resource_id},
        )


class ResourceConflictError(ApplicationError):
    def __init__(self, resource: str, field: str, value: str) -> None:
        super().__init__(
            status_code=409,
            code="RESOURCE_CONFLICT",
            message=f"{resource} already exists.",
            details={"resource": resource, "field": field, "value": value},
        )
