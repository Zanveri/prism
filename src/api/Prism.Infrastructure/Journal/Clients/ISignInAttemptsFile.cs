namespace Prism.Infrastructure.Journal.Clients;

public interface ISignInAttemptsFile
{
    void Add(string userName, DateTimeOffset at);

    IReadOnlyList<DateTimeOffset> Take(string userName);
}
