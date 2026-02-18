using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace Echo.Api.Swagger;

/// <summary>
/// Ensures IFormFile is documented as file (string, binary) so Swagger can generate the spec
/// and UI for multipart/form-data file uploads.
/// </summary>
public class FormFileSchemaFilter : ISchemaFilter
{
    public void Apply(OpenApiSchema schema, SchemaFilterContext context)
    {
        if (context.Type == typeof(IFormFile))
        {
            schema.Type = "string";
            schema.Format = "binary";
            schema.Description = "Audio chunk file (e.g. .webm)";
        }
    }
}
