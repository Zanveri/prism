global using NUnit.Framework;

// Os fixtures de Api/ se marcam [Parallelizable(ParallelScope.Self)]: cada teste deles sobe um
// ApiHost próprio, então as classes rodam em paralelo entre si e os testes de cada classe em
// sequência. Os fixtures de processo (ProcessHostingTests) ficam fora disso, para o prazo de 5 s
// do encerramento não competir com outros testes por CPU.
[assembly: NonParallelizable]

// Os testes comparam as mensagens em português, e o texto de um `.resx` sai na UICulture: pt-BR em qualquer máquina, como num pedido sem
// `Accept-Language`. Só a UICulture; a CurrentCulture continua a da máquina.
[assembly: SetUICulture("pt-BR")]
